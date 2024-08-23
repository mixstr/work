<?php

namespace app\service;

use Doctrine\ORM\EntityManager;
use app\entities\EmployeeEntity;
use DateTime;

class EmployeeService
{
    public EntityManager $entityManager;
    public array $employees;

    public function __construct()
    {
        require_once "bootstrap.php";
        $this->entityManager = callEntityManager();
    }

    public function selectAll()
    {
        $employees = $this->entityManager->getRepository('app\entities\EmployeeEntity')->findAll();
        echo ("selectAll method executed");
        print_r ($employees);
    }

    public function selectById(int $id)
    {
        $employees = $this->entityManager->find('app\entities\EmployeeEntity', $id);
        echo ("selectById method executed");
        print_r ($employees);
    }

    public function selectByFio(string $fio)
    {
        $employees = $this->entityManager->getRepository('app\entities\EmployeeEntity')->findBy(array('fio' => $fio));
        echo ("selectByFio method executed");
        print_r ($employees);
    }

    public function selectByHire(DateTime $hire_date)
    {
        $employees = $this->entityManager->getRepository('app\entities\EmployeeEntity')->findBy(array('hire_date' => $hire_date));
        echo ("selectByHire method executed");
        print_r ($employees);
    }

    public function selectByTermination(DateTime $termination_date) 
    {
        $employees = $this->entityManager->getRepository('app\entities\EmployeeEntity')->findBy(array('termination_date' => $termination_date));
        echo ("selectByTermination method executed");
        print_r ($employees);
    }

    public function insert($id, $fio, $hire_date, $termination_date)
    {
        $employeeEntity = new EmployeeEntity();

        $employeeEntity->setId($id);
        $employeeEntity->setFio($fio);
        $employeeEntity->setHireDate($hire_date);

        foreach ($termination_date as $value) {
            $employeeEntity->setTerminationDate($value);
        }

        $this->entityManager->persist($employeeEntity);
        $this->entityManager->flush();

        echo ("Insert method executed");
        print_r ($employeeEntity);
    }

    public function update($id, $fio, $hire_date, $termination_date)
    {
        $employeeEntity = $this->entityManager->find('app\entities\EmployeeEntity', $id);
        $employeeEntity->setFio($fio);

        foreach ($hire_date as $value) {
            $employeeEntity->setHireDate($value);
        }

        foreach ($termination_date as $value) {
            $employeeEntity->setTerminationDate($value);
        }

        $this->entityManager->flush();

        echo ("Update method executed");
        print_r ($employeeEntity);
    }
    public function delete($id)
    {
        $employeeEntity = $this->entityManager->find('app\entities\EmployeeEntity', $id);
        $this->entityManager->remove($employeeEntity);
        $this->entityManager->flush();

        echo ("Delete method executed");
        print_r ($employeeEntity);
    }
}


