<?php

namespace app\controller;

use app\service\CoefficientService;
use app\core\RequestValidator;
use Doctrine\ORM\EntityManager;

class CoefficientController
{
    public $validator;
    private CoefficientService $coefficientService;
    public EntityManager $entityManager;

    public function __construct()
    {
        require_once "bootstrap.php";
        $this->entityManager = callEntityManager();
        $this->validator = new RequestValidator($_REQUEST);
        $this->coefficientService = new CoefficientService();
    }

    public function selectAll()
    {
        $this->coefficientService->selectAll();
    }

    public function selectById($id)
    {
        $id = $this->validator->validateInt('id');
        $this->coefficientService->selectById($id);
    }
    
    public function selectByEmployee($employee_id)
    {
        $employee_id = $this->validator->validateInt('employee_id');
        $this->coefficientService->selectByEmployee($employee_id);
    }
    
    public function selectByMonth($month_id)
    {
        $month_id = $this->validator->validateInt('month_id');
        $this->coefficientService->selectByMonth($month_id);
    }

    public function insert($request)
    {
        $id =  $this->validator->validateInt('id', 'int');
        $employee_id = $this->validator->validateInt('employee_id', 'int');
        $month_id = $this->validator->validateInt('month_id', 'int');
        $coefficient = $this->validator->validateParam('coefficient', 'float');
        $this->coefficientService->insert($id, $employee_id, $month_id, $coefficient);
    }
    public function update($request)
    {
        $id =  $this->validator->validateInt('id', 'int');
        $employee_id = $this->validator->validateParam('employee_id', 'int');
        $month_id = $this->validator->validateParam('month_id', 'int');
        $coefficient = $this->validator->validateParam('coefficient', 'float');
        $this->coefficientService->update($id, $employee_id, $month_id, $coefficient);
    }

    public function delete($request)
    {
        $id = $this->validator->validateInt('id');
        $this->coefficientService->delete($id);
    }
}
