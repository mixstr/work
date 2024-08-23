<?php

namespace app\service;

use Doctrine\ORM\EntityManager;
use app\entities\MonthEntity;

class MonthService
{
    public EntityManager $entityManager;
    public array $month;

    public function __construct()
    {
        require_once "bootstrap.php";
        $this->entityManager = callEntityManager();
    }

    public function selectAll()
    {
        $months = $this->entityManager->getRepository('app\entities\MonthEntity')->findAll();
        echo ("selectAll method executed");
        print_r ($months);
    }

    public function selectById($id)
    {
        $months = $this->entityManager->find('app\entities\MonthEntity', $id);
        echo ("selectById method executed");
        print_r ($months);
    }

    public function selectByName($name)
    {
        $months = $this->entityManager->getRepository('app\entities\MonthEntity')->findBy(array('name' => $name));
        echo ("selectByName method executed");
        print_r ($months);
    }

    public function selectByDay($day)
    {
        $months = $this->entityManager->getRepository('app\entities\MonthEntity')->findBy(array('day' => $day));
        echo ("selectByDay method executed");
        print_r ($months);
    }

    public function selectByMonth($monthID)
    {
        $months = $this->entityManager->getRepository('app\entities\MonthEntity')->findBy(array('month' => $monthID));
        echo ("selectByMonth method executed");
        print_r ($months);
    }

    public function selectByYear($year)
    {
        $months = $this->entityManager->getRepository('app\entities\MonthEntity')->findBy(array('year' => $year));
        echo ("selectByYear method executed");
        print_r ($months);
    }

    public function insert($id, $name, $day, $month, $year)
    {
        $monthEntity = new MonthEntity();

        $monthEntity->setId($id);

        foreach ($name as $value) {
            $monthEntity->setName($value);
        }

        foreach ($day as $value) {
            $monthEntity->setDay($value);
        }

        foreach ($month as $value) {
            $monthEntity->setMonth($value);
        }

        foreach ($year as $value) {
            $monthEntity->setYear($value);
        }

        $this->entityManager->persist($monthEntity);
        $this->entityManager->flush();

        echo ("Insert method executed");
        print_r ($monthEntity);
    }

    public function update($id, $name, $day, $month, $year)
    {
        $monthEntity = $this->entityManager->find('app\entities\MonthEntity', $id);
        foreach ($name as $value) {
            $monthEntity->setName($value);
        }
        
        foreach ($day as $value) {
            $monthEntity->setDay($value);
        }
    
        foreach ($month as $value) {
            $monthEntity->setMonth($value);
        }

        foreach ($year as $value) {
            $monthEntity->setYear($value);
        }

        $this->entityManager->flush();
        
        echo ("Update method executed");
        print_r ($monthEntity);
    }
    public function delete($id)
    {
        $monthEntity = $this->entityManager->find('app\entities\MonthEntity', $id);
        $this->entityManager->remove($monthEntity);
        $this->entityManager->flush();

        echo ("Delete method executed");
        print_r ($monthEntity);
    }
}